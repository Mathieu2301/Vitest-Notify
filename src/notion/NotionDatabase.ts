import Logger from '../logger';

import type Controller from './DatabaseController';
import type { Language } from './DatabaseController';

const logger = new Logger('Notion');

export type IconName = (
  | 'question-mark'
  | 'checkmark'
  | 'clear'
  | 'code'
  | 'playback-pause'
  | 'playback-play'
  | 'checklist'
  | 'list'
  | 'layers'
);

export type IconColor = (
  | 'green'
  | 'blue'
  | 'yellow'
  | 'red'
  | 'pink'
  | 'lightgray'
);

export type Icon = `${IconName}_${IconColor}`;
export type IconUrl = `https://www.notion.so/icons/${Icon}.svg`;

export const getIconUrl = (icon: Icon): IconUrl => `https://www.notion.so/icons/${icon}.svg`;

export interface NotionDatabaseConfig {
  controller: Controller;
  id: string;
}

type Partial<T> = { [prop in keyof T]?: T[prop] };

type MetaData = {
  id: string;
  type: 'page' | 'database';
  archived: boolean;
  created_time: string;
  last_edited_time: string;
  url: string;
  public_url?: string;
};

export type RequiredProperties<
  FieldId extends string = string,
  FieldName extends string = string,
  FieldType extends string = 'title' | 'select' | 'people' | 'status' | 'checkbox' | 'relation' | 'rollup',
> = {
  [fieldId in FieldId]: {
    name: { [lang in Language]: FieldName };
    type: FieldType;
    optional?: boolean;
  };
}

type PropertyId<RP extends RequiredProperties> = keyof RP;
type Property<RP extends RequiredProperties> = RP[PropertyId<RP>];
type PropertyName<RP extends RequiredProperties> = Property<RP>['name'][Language];
type PropertyType<RP extends RequiredProperties> = Property<RP>['type'];

type NotionPropertiesTypes = {
  title: { title: { text: { content: string }, type?: 'text' }[] };
  select: { select: { name: string } };
  people: { people: { id: string }[] };
  status: { status: { name: string } };
  checkbox: { checkbox: boolean };
  relation: { relation: { id: string }[] };
  rollup: { rollup: { array: NotionPropertiesTypes[keyof NotionPropertiesTypes][] } };
};

type HeaderObject<RP extends RequiredProperties> = {
  title: NotionPropertiesTypes['title']['title'];
  properties: {
    [propId in PropertyId<RP>]: {
      id: string;
      name: RP[propId]['name'][Language];
      type: RP[propId]['type'];
    };
  };
  icon: Icon;
};

type PropsByName<RP extends RequiredProperties> = {
  [propName in PropertyName<RP>]: NotionPropertiesTypes[RP[propName]['type']];
};

type PropsById<RP extends RequiredProperties> = {
  [propId in PropertyId<RP>]: NotionPropertiesTypes[RP[propId]['type']];
};

export type PageObject<RP extends RequiredProperties> = {
  id: string;
  url: string;
  properties: PropsById<RP>;
};

export type NewPageObject<RP extends RequiredProperties> = {
  properties: Partial<PropsById<RP>>;
  content?: any[];
  icon?: Icon;
};

type EqualsCompareFilter<T> = { equals: T } | { does_not_equal: T };
type ContainsCompareFilter = { contains: string } | { does_not_contain: string };
type EmptyCompareFilter = { is_empty: boolean } | { is_not_empty: boolean };
type StartsEndsCompareFilter = { starts_with: string } | { ends_with: string };

type FilterObject<RP extends RequiredProperties> = (
  | { and: FilterObject<RP>[] }
  | { or: FilterObject<RP>[] }
  | {
    // equals(string), contains, starts/ends
    title: { property: PropertyId<RP>; title: EqualsCompareFilter<string> | ContainsCompareFilter | StartsEndsCompareFilter };
    // equals(string), empty
    select: { property: PropertyId<RP>; select: EqualsCompareFilter<string> | EmptyCompareFilter };
    // contains, empty
    multi_select: { property: PropertyId<RP>; multi_select: ContainsCompareFilter | EmptyCompareFilter };
    // contains, empty
    people: { property: PropertyId<RP>; people: ContainsCompareFilter | EmptyCompareFilter };
    // equals(string), empty
    status: { property: PropertyId<RP>; status: EqualsCompareFilter<string> | EmptyCompareFilter };
    // equals(boolean)
    checkbox: { property: PropertyId<RP>; checkbox: EqualsCompareFilter<boolean> };
    // contains, empty
    relation: { property: PropertyId<RP>; relation: ContainsCompareFilter | EmptyCompareFilter };
    // unknown
    rollup: any;
  }[Property<RP>['type']]
);

export default class NotionDatabase<RequiredProps extends RequiredProperties> {
  public readonly name: string;
  protected readonly controller: Controller;
  readonly id: string;
  readonly fields: RequiredProps;

  constructor({ controller, id }: NotionDatabaseConfig, fields: RequiredProps) {
    this.controller = controller;
    this.id = id;
    this.fields = fields;
  }

  protected async prepareDatabase(header: any) {
    return;
  }

  public async setup() {
    logger.log(`Setting up '${this.name}' database...`);

    const header = await this.controller.client.databases.retrieve({
      database_id: this.id,
    }) as any;

    if (!this.controller.lang) {
      logger.log('  Getting databases language...');
      this.controller.lang = this.getTableLang(header);
      logger.log(`  Detected language: ${this.controller.lang}`);
    }

    await this.prepareDatabase(header);

    logger.log('  Checking database schema...');
    const result = this.checkTableSchema(header);
    logger.separator();
    return result;
  }

  public async getHeader(): Promise<HeaderObject<RequiredProps> & MetaData> {
    const data = await this.controller.client.databases.retrieve({
      database_id: this.id,
    }) as any;

    return {
      ...data,
      properties: this.propsNamesToIds(data.properties),
    };
  }

  public editHeader(
    { title, properties, icon }: Partial<HeaderObject<RequiredProps>>,
  ) {
    return this.controller.client.databases.update({
      database_id: this.id,
      title,
      properties: (properties
        ? this.propsIdsToNames(properties as any) as any
        : undefined
      ),
      icon: (icon
        ? { type: 'external', external: { url: getIconUrl(icon) } }
        : undefined
      ),
    });
  }

  public async getRows(filter?: FilterObject<RequiredProps>) {
    const translateFilter = (filter: FilterObject<RequiredProps>): any => {
      const translated: any = filter;
      if (translated.property) translated.property = this.propIdToName(translated.property);
      if (translated.and) translated.and = translated.and.map(translateFilter);
      if (translated.or) translated.or = translated.or.map(translateFilter);
      return translated;
    };

    const data = await this.controller.client.databases.query({
      database_id: this.id,
      filter: filter ? translateFilter(filter) : undefined,
    });

    return {
      ...data,
      results: data.results.map((row: {
        id: string,
        object: 'page',
        icon: {
          type: 'external',
          external: { url: IconUrl },
        },
        url: string,
      }) => ({
        ...row,
        properties: this.propsNamesToIds((row as any).properties) as PropsById<RequiredProps>,
      })),
    }
  }

  public async createRow(
    { properties, content, icon }: NewPageObject<RequiredProps>,
  ): Promise<PageObject<RequiredProps>> {
    const response = await this.controller.client.pages.create({
      parent: { database_id: this.id },
      properties: (properties
        ? this.propsIdsToNames(properties) as any
        : undefined
      ),
      children: content,
      icon: (icon
        ? { type: 'external', external: { url: getIconUrl(icon) } }
        : undefined
      ),
    }) as any;

    return {
      ...response,
      properties: this.propsNamesToIds(response.properties) as PropsById<RequiredProps>,
    };
  }

  public editRow(
    { id, properties, icon }: NewPageObject<RequiredProps> & Partial<MetaData>,
  ) {
    return this.controller.client.pages.update({
      page_id: id,
      properties: (properties
        ? this.propsIdsToNames(properties) as any
        : undefined
      ),
      icon: (icon
        ? { type: 'external', external: { url: getIconUrl(icon) } }
        : undefined
      ),
    });
  }

  public propIdToName(propId: PropertyId<RequiredProps>) {
    return (
      this.fields[propId].name[this.controller.lang]
    ) as RequiredProps[typeof propId]['name'][Language];
  }

  private propsIdsToNames(props: Partial<PropsById<RequiredProps>>) {
    return Object.fromEntries(
      Object.entries(props).map(([propId, value] : [
        PropertyId<RequiredProps>,
        NotionPropertiesTypes[PropertyType<RequiredProps>],
      ]) => {
        const propName = this.propIdToName(propId);
        return [propName, value];
      }
    )) as Partial<PropsByName<RequiredProps>>;
  }

  public propsNamesToIds(props: Partial<PropsByName<RequiredProps>>) {
    return Object.fromEntries(
      Object.entries(props).map(([propName, value] : [
        PropertyName<RequiredProps>,
        NotionPropertiesTypes[PropertyType<RequiredProps>],
      ]) => {
        const propId: PropertyId<RequiredProperties> = Object.keys(this.fields).find(
          (propId) => this.fields[propId].name[this.controller.lang] === propName,
        );
        return [propId, value];
      }
    )) as Partial<PropsById<RequiredProps>>;
  }

  private getTableLang(
    { properties }: { properties: PropsByName<RequiredProps> },
  ): Language {
    const tablePropNames: PropertyName<RequiredProps>[] = Object.keys(properties);
    const requiredProps: { [lang in Language]?: PropertyName<RequiredProps>[] } = {};

    for (const fieldId in this.fields) {
      const { name } = this.fields[fieldId];

      for (const _lang in name) {
        const lang = _lang as Language;
        if (!requiredProps[lang]) requiredProps[lang] = [];
        requiredProps[lang].push(name[lang]);
      }
    }

    const missingProps: { [lang in Language]?: PropertyName<RequiredProps>[] } = {};
    for (const _lang in requiredProps) {
      const lang = _lang as Language;
      missingProps[lang] = [];
      for (const propName of requiredProps[lang]) {
        if (!tablePropNames.includes(propName)) missingProps[lang].push(propName);
      }
    }

    const nearestLang = Object.keys(missingProps).reduce((prev: Language, curr: Language) => {
      if (missingProps[prev].length > missingProps[curr].length) return curr;
      return prev;
    }) as Language;

    return nearestLang;
  }

  private checkTableSchema(
    { properties }: { properties: PropsByName<RequiredProps> },
  ): boolean {
    const tablePropsTypes = Object.fromEntries(
      Object.entries(properties).map(([
        propName, prop,
      ]: [
        PropertyName<RequiredProps>,
        Property<RequiredProps>,
      ]) => [propName, prop.type]),
    ) as { [propName in PropertyName<RequiredProps>]: PropertyType<RequiredProps> };

    const requiredPropsTypes = Object.fromEntries(
      Object
        .values(this.fields)
        .filter((field) => !field.optional)
        .map((field) => [field.name[this.controller.lang], field.type]),
    ) as { [propName in PropertyName<RequiredProps>]: PropertyType<RequiredProps> };

    const issues = Object.entries(requiredPropsTypes).map(([
      propName, requiredPropType,
    ]: [
      PropertyName<RequiredProps>,
      PropertyType<RequiredProps>,
    ]) => {
      if (!tablePropsTypes[propName]) return {
        propName: propName,
        requiredType: requiredPropType,
        issue: 'missing',
      };

      if (tablePropsTypes[propName] !== requiredPropType) return {
        propName: propName,
        issue: 'type',
        propType: tablePropsTypes[propName],
        requiredType: requiredPropType,
      };

      return null;
    }).filter((issue) => issue !== null) as (
      {
        propName: PropertyName<RequiredProps>;
        requiredType: PropertyType<RequiredProps>;
        issue: 'missing';
      } | {
        propName: PropertyName<RequiredProps>;
        issue: 'type';
        propType: PropertyType<RequiredProps>;
        requiredType: PropertyType<RequiredProps>;
      }
    )[];

    if (issues.length > 0) {
      logger.error([
        '  Invalid schema:',
        ...issues.map((issue) => {
          if (issue.issue === 'missing') return `    - Missing property '${issue.propName}' (type: ${issue.requiredType})`;
          return `    - Invalid type for property '${issue.propName}': expected '${issue.requiredType}', got '${issue.propType}'`;
        }),
      ].join('\n'));
      return false;
    }

    logger.log('  Schema is valid');
    return true;
  }
}

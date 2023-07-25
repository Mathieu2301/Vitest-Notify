import Logger from '../../logger';

import NotionDatabase, {
  type NotionDatabaseConfig,
} from '../NotionDatabase';

const logger = new Logger('Notion');

const requiredProps = {
  name: { name: { EN: 'Message', FR: 'Message' }, type: 'title' },
  test: { name: { EN: 'Associated test', FR: 'Test associé' }, type: 'relation' },
  assigned: { name: { EN: 'Assigned', FR: 'Assigné' }, type: 'people' },
  importance: { name: { EN: 'Importance', FR: 'Importance' }, type: 'select' },
  status: { name: { EN: 'Test status', FR: 'État du test' }, type: 'rollup', optional: true },
} as const;

type RequiredProps = typeof requiredProps;

export default class IssuesDatabase extends NotionDatabase<RequiredProps> {
  readonly name = 'issues';

  constructor(config: NotionDatabaseConfig) {
    super(config, requiredProps);
  }

  protected async prepareDatabase(header: any) {
    const propertyName = this.fields.test.name[this.controller.lang];
    const testProperty = header.properties[propertyName];

    if (
      testProperty
      && testProperty.type === 'relation'
      && testProperty.relation?.database_id.replace(/-/g, '') === this.controller.tests.id
    ) return;

    logger.info(`Setting '${propertyName}' property as a relation...`);
    await this.controller.client.databases.update({
      database_id: this.id,
      properties: {
        [propertyName]: {
          relation: {
            database_id: this.controller.tests.id,
            type: 'single_property',
            single_property: {},
          },
        },
      },
    });
  }
}

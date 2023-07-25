import NotionDatabase, {
  type NotionDatabaseConfig,
  type Icon,
  type PageObject,
  type NewPageObject,
} from '../NotionDatabase';

export type TestStatus = 'PASS' | 'FAIL' | 'SKIP' | 'TODO' | 'ONLY' | 'RUN' | 'UNKNOWN';

export const statusIconsUrls: { [status in TestStatus]: Icon } = {
  PASS: 'checkmark_green',
  FAIL: 'clear_red',
  SKIP: 'playback-pause_blue',
  TODO: 'code_pink',
  ONLY: 'checkmark_blue',
  RUN: 'playback-play_gray',
  UNKNOWN: 'question-mark_yellow',
};

const requiredProps = {
  name: { name: { EN: 'Name', FR: 'Nom' }, type: 'title' },
  project: { name: { EN: 'Project', FR: 'Projet' }, type: 'select' },
  tag: { name: { EN: 'Tag', FR: 'Tag' }, type: 'select' },
  fileName: { name: { EN: 'File', FR: 'Fichier' }, type: 'select' },
  assigned: { name: { EN: 'Assigned', FR: 'Assigné' }, type: 'people' },
  importance: { name: { EN: 'Importance', FR: 'Importance' }, type: 'select' },
  status: { name: { EN: 'Status', FR: 'État' }, type: 'status' },
  archived: { name: { EN: 'Archived', FR: 'Archivé' }, type: 'checkbox' },
  active: { name: { EN: 'Active', FR: 'Actif' }, type: 'checkbox' },
} as const;

type RequiredProps = typeof requiredProps;

export type TestPage = PageObject<RequiredProps>;
export type NewTestPage = NewPageObject<RequiredProps>;

export default class TestsDatabase extends NotionDatabase<RequiredProps> {
  readonly name = 'tests';

  constructor(config: NotionDatabaseConfig) {
    super(config, requiredProps);
  }
}

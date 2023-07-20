export default class Logger {
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  private prefix() {
    return `[${this.name}]`;
  }

  public log(...args: any[]) {
    console.log(this.prefix(), ...args);
  }

  public error(...args: any[]) {
    console.error(this.prefix(), ...args);
  }

  public warn(...args: any[]) {
    console.warn(this.prefix(), ...args);
  }

  public info(...args: any[]) {
    console.info(this.prefix(), ...args);
  }

  public debug(...args: any[]) {
    console.debug(this.prefix(), ...args);
  }

  public trace(...args: any[]) {
    console.trace(this.prefix(), ...args);
  }

  public separator() {
    console.log('');
  }
}

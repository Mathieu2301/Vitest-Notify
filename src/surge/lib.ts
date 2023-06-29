import https from 'https';
// @ts-expect-error
import fsReader from 'surge-fstream-ignore';
// @ts-expect-error
import tar from 'tarr';
import zlib from 'zlib';

export interface SurgeLoginResponse {
  email: string;
  token: string;
}

export function login(email: string, password: string): Promise<SurgeLoginResponse> {
  return new Promise((resolve) => {
    https.request({
      method: 'POST',
      hostname: 'surge.surge.sh',
      path: '/token',
      auth: `${email}:${password}`,
    }, (res) => {
      let body = '';

      res.on('data', (d) => body += d);
      res.on('end', () => {
        const parsed: SurgeLoginResponse = JSON.parse(body);

        if (!parsed.email || !parsed.token) {
          console.log('Surge login failed:', parsed);
          process.exit(1);
        }

        resolve(parsed);
      });
    }).end();
  });
}

export interface SurgeConfig {
  email: string;
  password: string;
  /** Path to the directory to upload */
  directory: string;
  domain?: string;
  /** Default: ['.git', '.*', '*.*~', 'node_modules'] */
  ignoreRules?: string[];
  /** Default: ['.surgeignore'] */
  ignoreFiles?: string[];
}

export interface UploadResponse {
  domain: string;
}

export function upload(config: SurgeConfig): Promise<UploadResponse> {
  return new Promise(async (resolve) => {
    const { token } = await login(config.email, config.password);
    const domain = config.domain ?? `${(Math.random() * 10 ** 25).toString(36)}.surge.sh`;

    const handshake = https.request({
      method: 'PUT',
      hostname: 'surge.surge.sh',
      path: `/${domain}`,
      auth: `token:${token}`,
    }, (res) => {
      let body = '';

      res.on('data', (d) => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error(`Surge upload failed: ${res.statusCode} (${res.statusMessage})`);
          console.error('Server response:', body);
          process.exit(1);
        }

        resolve({ domain });
      });
    });

    handshake.on('error', () => {
      console.error('Surge upload failed: request error');
      process.exit(1);
    });

    const project = fsReader({
      path: config.directory,
      ignoreFiles: config.ignoreFiles ?? ['.surgeignore'],
    });

    project.addIgnoreRules(config.ignoreRules ?? [
      '.git',
      '.*',
      '*.*~',
      'node_modules',
    ]);

    project
      .pipe(new tar.Pack())
      .pipe((zlib as any).Gzip())
      .pipe(handshake);
  });
}

export default {
  login,
  upload,
};

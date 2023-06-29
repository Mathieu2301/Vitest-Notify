import surge from './lib';
import env from '../config';

const config = {
  email: env('SURGE_EMAIL'),
  password: env('SURGE_PASSWORD'),
  url: env('SURGE_URL'),
};

export const available = (
  !!config.email
  && !!config.password
  && !!config.url
);

const genReportDomain = () => {
  const addZero = (n: number) => n < 10 ? `0${n}` : n.toString();
  const fullYear = new Date().getFullYear().toString();

  return ((config.url as string)
    .replace('{DD}', addZero(new Date().getDate()))
    .replace('{MM}', addZero(new Date().getMonth() + 1))
    .replace('{YYYY}', fullYear)
    .replace('{YY}', fullYear.slice(2))
    .replace('{RND}', Math.random().toString(36).slice(2, 8))
  );
};

export async function uploadToSurge(directory: string) {
  if (!available) throw new Error('Surge is not available');

  return surge.upload({
    email: config.email as string,
    password: config.password as string,
    directory,
    domain: genReportDomain(),
  });
}

export default available;

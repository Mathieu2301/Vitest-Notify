import dotenv from 'dotenv';

dotenv.config();

export default (key: string) => process.env[key];

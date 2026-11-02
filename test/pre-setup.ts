import path from 'path';

process.env.MONGOMS_VERSION = '7.0.14';
process.env.MONGOMS_DOWNLOAD_DIR = path.resolve(__dirname, '../.cache/mongodb-binaries');


// Panorama — MUP (Meteor Up) deployment configuration
// Credentials read from environment: source ~/.env.secrets before running mup
//
// Usage:
//   source ~/.env.secrets
//   nvm exec 20.9.0 mup setup    # first time only
//   nvm exec 20.9.0 mup deploy

const MONGO_USER = process.env.PANORAMA_MONGO_USER;
const MONGO_PASS = process.env.PANORAMA_MONGO_PASS;

if (!MONGO_USER || !MONGO_PASS) {
  throw new Error(
    'Missing PANORAMA_MONGO_USER or PANORAMA_MONGO_PASS. Run: source ~/.env.secrets'
  );
}

// Docker internal network — no TLS needed (container-to-container)
const MONGO_URL = `mongodb://${MONGO_USER}:${MONGO_PASS}@organizer-mongodb:27017/panorama?authSource=admin`;
const MONGO_OPLOG_URL = `mongodb://${MONGO_USER}:${MONGO_PASS}@organizer-mongodb:27017/local?authSource=admin`;

module.exports = {
  servers: {
    one: {
      host: '51.210.150.25',
      username: 'ubuntu',
      // Uses ssh-agent (ed25519 key loaded via ssh-add)
    },
  },

  app: {
    name: 'panorama',
    path: '../',
    docker: {
      image: 'zodern/meteor:root',
      stopAppDuringPrepareBundle: false,
      args: [
        '--network=server_organizer-network',
        '-v', '/var/www/panorama/files:/var/www/panorama/files',
      ],
    },
    servers: { one: {} },
    buildOptions: {
      serverOnly: true,
    },
    env: {
      ROOT_URL: 'https://panorama.mickaelfm.me',
      MONGO_URL,
      MONGO_OPLOG_URL,
      PANORAMA_MODE: 'remote',
      PANORAMA_FILES_DIR: '/var/www/panorama/files',
      QDRANT_URL: 'http://organizer-qdrant:6333',
      PANORAMA_FILES_API_KEY: process.env.PANORAMA_FILES_API_KEY,
    },
    deployCheckWaitTime: 120,
  },

  proxy: {
    domains: 'panorama.mickaelfm.me',
    ssl: {
      letsEncryptEmail: 'faivrem@gmail.com',
      forceSSL: true,
    },
  },

  // No mongo section — reusing organizer-mongodb
};

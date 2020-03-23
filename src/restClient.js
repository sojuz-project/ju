const axios = require('axios');

/**
 * Prepare REST Client instance
 * @param {String} auth
 * @return {Object} Preconfigured Axios client for REST requests
 */
const instance = (auth = '', path = '/wp-json') => {
  const args = {
    baseURL: 'http://wordpress' + path,
    timeout: 3000,
  };
  if (auth) args.headers = { Authorization: `Bearer ${auth}` };
  return axios.create(args);
};

module.exports = instance;

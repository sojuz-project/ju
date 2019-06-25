'use strict';

const { Database: Conn } = require('./db');

Object.defineProperty(exports, "__esModule", {
  value: true
});

module.exports = function (Conn, prefix) {
  return Conn.define(prefix + 'options', {
    option_id: { type: _sequelize2.default.INTEGER, primaryKey: true },
    option_name: { type: _sequelize2.default.STRING },
    option_value: { type: _sequelize2.default.STRING },
    autoload: { type: _sequelize2.default.BOOLEAN },
  });
};

var _sequelize = require('sequelize');

var _sequelize2 = _interopRequireDefault(_sequelize);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
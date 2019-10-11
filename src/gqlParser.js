const { graphql } = require('graphql');

module.exports = async (schema, query, variables) => {
  const { data } = await graphql(schema, query, null, null, variables);
  return data;
};

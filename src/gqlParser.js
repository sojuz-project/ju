const { graphql } = require('graphql');

module.exports = async (schema, query, variables, ctx) => {
  // console.log('gqlParser', query, variables);
  const { data } = await graphql(schema, query, null, ctx, variables);
  return data;
};

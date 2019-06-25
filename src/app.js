const { ApolloServer, gql } = require('apollo-server');
const {makeExecutableSchema} = require('graphql-tools');
const {WordExpressDefinitions, WordExpressResolvers} = require('wordexpress-schema');
const { ExtraQuery, ExtraResolvers } = require('./extra');
const {connectors} = require('./db');
const merge = require('lodash.merge');
const jwt = require('jsonwebtoken');
const jwtKey = ']`6Sc^Rq.UB>uP}h|.sfw!$NBMSf1hKfo(].Ik`E$5(&lO6eBDRdmP%J,jb)TjSs';

const RootResolvers = WordExpressResolvers(connectors);
const Resolvers = merge(RootResolvers, ExtraResolvers);

const server = new ApolloServer({ 
    typeDefs: [...WordExpressDefinitions, ExtraQuery], 
    resolvers: Resolvers,
    subscriptions: {
        path: '/socket',
    },
    context: ({ req, connection }) => {
      if (connection) {
        // check connection for metadata
        return connection.context;
      }
      // check from req
      const authHeader = req.headers.authorization || '';
  
      if (authHeader.length > 6) {
        const token = authHeader.replace('Bearer ', '');
        try {
          const { data: { user: {id: userId } } } = jwt.verify(token, jwtKey);
          return { token, userId };
        } catch (e) {
          return { token, userId: null };
        }
      }
  
    },
});

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`🚀  Server ready at ${url}`);
  console.log(`🚀  Subscriptions ready at ${subscriptionsUrl}`);
});
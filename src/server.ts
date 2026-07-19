import { createYoga, createSchema } from 'graphql-yoga';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';

/**
 * Builds the shared GraphQL Yoga instance used by both the local dev server
 * (index.ts) and the AWS Lambda handler (lambda.ts). Keeping a single factory
 * means schema/resolver changes apply identically in both environments.
 */
export function createYogaInstance() {
  const schema = createSchema({
    typeDefs,
    resolvers,
  });

  return createYoga({
    schema,
    graphqlEndpoint: '/graphql',
  });
}

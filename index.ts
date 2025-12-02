import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { schema } from './src/graphql/schema';
import { createContext } from './src/context';

const yoga = createYoga({
  schema,
  context: createContext,
});

const server = createServer(yoga);

server.listen(4000, () => {
  console.log('GraphQL API on http://localhost:4000/graphql');
});

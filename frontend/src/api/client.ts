/**
 * LOCAL DEV ONLY — not part of the drop-in.
 * The host app provides its own ApolloProvider. Remove this file when integrating.
 *
 * Uses apollo-link-rest to wrap the Phoenix REST API so Apollo hooks work
 * without a GraphQL server. When the host adds real mutations, swap the RestLink
 * for an HttpLink pointing at their schema.
 */
import { ApolloClient, InMemoryCache } from "@apollo/client";
import { RestLink } from "apollo-link-rest";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000/api";

const restLink = new RestLink({
  uri: API_BASE,
  headers: {
    "content-type": "application/json",
  },
});

export const devClient = new ApolloClient({
  link: restLink,
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: { fetchPolicy: "cache-and-network" },
  },
});

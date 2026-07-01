# Nightscout GraphQL Proxy

A GraphQL proxy for a Nightscout API instance.

## Purpose

1. **Obscurity:** Protects the underlying Nightscout instance by hiding the direct API endpoints and potentially the instance URL.
2. **Ease of Use:** Provides a strongly-typed GraphQL schema, making it much easier for Agents and Frontends (FEs) to query only the data they need and interact with the Nightscout data.

## Next Steps

- Set up a GraphQL server (e.g., Apollo Server, GraphQL Yoga).
- Define the GraphQL schema for Nightscout entities (Entries, Treatments, Profiles, etc.).
- Implement resolvers that proxy requests to the Nightscout REST API.

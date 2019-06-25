# Junction for sojuz project

This is the server component for the Zero-theme. It links WordPress database and serves it as GraphQL API.

## Setup
 1. Make sure that you have defiend docker network `web`
    ```
    docker network ls | grep web
    ```
    if the result looks similar to this:
    ```
    c3f6d40ce98a        web                      bridge              local
    ```
    you're good to continue.
    <details>
    <summary>If not, then create the <code>web</code> network</summary>
    <pre>
    docker network create web
    </pre>
    </details>
 2. In your `/etc/hosts` file point `docker.local` to `127.0.0.1`
 3. Rename `.env.sample` file to `.env` and maybe edit it according to your needs
 4. Run the stack in foreground for the first time:
    ```
    docker-compose up
    ```
    The output may contain vital information about what's wrong if anything
 5. The API server is normally proxied via traefik instance provided by the so part of sojuz project. But for development purposes it listens <sup>override</sup> on port `4000`

## Running
To startup the server issue appropriate docker-compose command such as:
```
docker-compose up
```
for debug, or (for production):
```
docker-compose -f docker-compose.yml up -d
```
if everything went well it should be avaliable under http://docker.local:4000
# Junction for SOJUZ project

This is the server component for the Zero-theme. It links WordPress database and serves it as GraphQL API.

## Setup
 1. To run this component you should have docker network named `web`
    <details>
      <summary>How to check if i have one?</summary>
      <pre>docker network ls | grep web</pre>
      the result should look similar to this:
      <pre>c3f6d40ce98a        web                      bridge              local</pre>
    </details>
    <details>
    <summary>How to create the <code>web</code> network</summary>
    <pre>docker network create web</pre>
    </details>
 2. Rename `.env.sample` file to `.env` and maybe change it according to your needs
    
    `UPLOADS_PATH` variable can use `HOSTNAME` placeholder which will be replaced with the contents od `HOSTNAME` variable
 3. Run the stack in foreground for the first time:
    ```
    docker-compose up
    ```
    The output may contain vital information about what's wrong if anything
 4. The API server is normally proxied via traefik instance provided by the [so](https://github.com/sojuz-project/so) part of SOJUZ project. But for development purposes it listens <sup>override</sup> on port `4000`

## Running
To start the server issue appropriate docker-compose command such as (for local development):
```
docker-compose up
```
if everything went well it should be avaliable under <sup>OVERRIDE</sup> http://localhost:4000

For production use:
```
docker-compose -f docker-compose.yml up -d
```
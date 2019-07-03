const { WordExpressDatabase } = require('wordexpress-schema');

const privateSettings = {
    wp_prefix: "wp_",
    database: {
        name: process.env.WORDPRESS_DB_NAME || "wordpress",
        username: process.env.WORDPRESS_DB_USER || "wordpress",
        password: process.env.WORDPRESS_DB_PASSWORD || "wordpress",
        host: process.env.WORDPRESS_DB_HOST || "db",
    }
};

const uploads = process.env.UPLOADS_PATH.replace(/HOSTNAME/, process.env.HOSTNAME);

const publicSettings = {
    uploads,
    amazonS3: false
};

const Database = new WordExpressDatabase({publicSettings, privateSettings})
const {connectors, models} = Database
 
// module.exports= Database
module.exports = {Database, connectors, models}
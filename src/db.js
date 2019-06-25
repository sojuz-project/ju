const { WordExpressDatabase } = require('wordexpress-schema');

const privateSettings = {
    wp_prefix: "wp_",
    database: {
        name: "wordpress",
        username: "wordpress",
        password: "wordpress",
        host: "db",
    }
};

const publicSettings = {
    uploads: `https://${process.env.HOSTNAME}/backend/wp-content/uploads/`,
    // uploads: "https://docker.local/backend/wp-content/uploads/",
    amazonS3: false
};

const Database = new WordExpressDatabase({publicSettings, privateSettings})
const {connectors, models} = Database
 
// module.exports= Database
module.exports = {Database, connectors, models}
var port = process.argv[2] || process.env.PORT || process.env.OPENSHIFT_NODEJS_PORT || 80;
var ip = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || "127.0.0.1";
var connect = require('connect');connect().use(connect.static(process.argv[3] || "public")).listen(port,ip);
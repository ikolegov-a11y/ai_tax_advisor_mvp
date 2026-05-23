// Vercel serverless entry point — re-exports the Express app
// All routes defined in backend/server.js are served through this file
module.exports = require('../backend/server');

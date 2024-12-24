module.exports = {
  apps: [
    {
      name: 'api',
      script: 'api.js',
      instances: process.env.NODE_ENV === 'production' ? 0 : 1, // Set instances to 0 in production
      // instances: 'max', 
      // instances: 1, 
      exec_mode: 'cluster',    
      watch: true, 
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        PROTOCOL: 'http',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        PROTOCOL: 'https',
      }      
    },
  ],
};

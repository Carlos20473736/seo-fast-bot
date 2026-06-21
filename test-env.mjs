import 'dotenv/config';
console.log('DB URL loaded:', !!process.env.DATABASE_URL);
console.log('URL prefix:', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 60) + '...' : 'EMPTY');

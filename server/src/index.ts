import { createApp } from "./app.js";
import { migrateAndSeed } from "./db/migrate.js";

const port = Number(process.env.PORT) || 5000;

await migrateAndSeed();
createApp().listen(port, () => {
  console.log(`HIMT Library listening on port ${port}`);
});

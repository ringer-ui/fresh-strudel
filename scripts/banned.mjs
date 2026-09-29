// Paths that must never be published: collected third-party code (some of it all-rights-reserved or non-commercial) and
// the corpus databases built from it. Used by the public build and by the source export, and tested.
export const BANNED_PATH = /(^|[\\/])(strudelstore|corpus[^\\/]*\.db(-wal|-shm)?|[^\\/]+\.(db|sqlite3?)(-wal|-shm)?)([\\/]|$)/i;

/** The folder Extract here makes for an archive: "Photos" for Photos.zip, "backup" for
 * backup.tar.gz. Folder insights look for the same name to tell an archive already extracted. */
export const extractedFolderName = (archive: string) =>
  archive.replace(/\.(?:tar\.gz|tgz|zip|tar)$/i, '') || 'Extracted archive';

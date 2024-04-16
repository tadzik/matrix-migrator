/** Migrator should not be using technical jargon, but errors should be as detailed as possible for development purposes.
 * Therefore, each of our errors has a user-friendly description, but stores the technical details also.
 */
export class MigratorError extends Error {
    constructor(
        public displayMessage: string,
        public technicalDetails: string,
    ) {
        super(`${displayMessage}: ${technicalDetails}`);
    }
}

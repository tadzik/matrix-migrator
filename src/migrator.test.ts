import { IgnoredUserList } from "./collector";
import { mergeDirectMessages, mergeIgnoredUserLists } from "./migrator";

describe('migrator', () => {
    test('correctly merges m.direct contents', () => {
        const sourceDMs = {
            '@alice:server': ['!sourcealicedm:server'],
            '@bob:server': ['!sourcebobdm:server'],
        };
        const targetDMs = {
            '@alice:server': ['!targetalicedm:server'],
            '@charlie:server': ['!targetcharliedm:server'],
        };
        const mergedDMs = mergeDirectMessages(sourceDMs, targetDMs);
        expect(mergedDMs).toEqual({
            '@alice:server': ['!targetalicedm:server', '!sourcealicedm:server'],
            '@bob:server': ['!sourcebobdm:server'],
            '@charlie:server': ['!targetcharliedm:server'],
        });

        // see if reapplying a migration is a noop
        const doubleMergedDMs = mergeDirectMessages(sourceDMs, mergedDMs);
        expect(doubleMergedDMs).toEqual({
            '@alice:server': ['!targetalicedm:server', '!sourcealicedm:server'],
            '@bob:server': ['!sourcebobdm:server'],
            '@charlie:server': ['!targetcharliedm:server'],
        });
    });

    test('correctly merges ignored user list', () => {
        const sourceIgnores: IgnoredUserList = {
            ignored_users: {
                '@foo:server': {},
                '@bar:server': {},
            },
        };
        const targetIgnores: IgnoredUserList = {
            ignored_users: {
                '@baz:server': {},
            },
        };
        const mergedIgnores = mergeIgnoredUserLists(sourceIgnores, targetIgnores);
        expect(mergedIgnores).toEqual({
            ignored_users: {
                '@foo:server': {},
                '@bar:server': {},
                '@baz:server': {},
            },
        });

        // see if reapplying a migration is a noop
        const doubleMergedIgnores = mergeIgnoredUserLists(sourceIgnores, mergedIgnores);
        expect(doubleMergedIgnores).toEqual({
            ignored_users: {
                '@foo:server': {},
                '@bar:server': {},
                '@baz:server': {},
            },
        });
    });
});

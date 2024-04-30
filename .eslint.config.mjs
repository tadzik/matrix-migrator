import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import jest from "eslint-plugin-jest";

export default [
    {
        languageOptions: {
            globals: globals.browser,
            parserOptions: {
                project: ['./.tsconfig-tests.json'],
            },
        },
        "rules": {
            "@typescript-eslint/no-floating-promises": "error",
            ...jest.configs['flat/recommended'].rules,
        },
        ...jest.configs['flat/recommended'],
    },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
];

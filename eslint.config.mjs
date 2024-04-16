import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";


export default [
    {
        languageOptions: {
            globals: globals.browser,
            parserOptions: {
                project: ['./tsconfig.json'],
            },
        },
        "rules": {
            "@typescript-eslint/no-floating-promises": "error"
        }
    },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
];

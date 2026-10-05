import js from "@eslint/js";
export default [
    js.configs.recommended,
    {
        files: ["**/*.jsx", "**/*.js"],
        languageOptions: {
            parserOptions: {
                ecmaFeatures: {
                    jsx: true
                }
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "off"
        }
    }
];

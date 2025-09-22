import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        ignores: [
            '.dev-server/',
            '.vscode/',
            '*.test.js',
            'test/**/**.js',
            'build/',
            'admin/build/',
            'admin/words.js',
            'admin/admin.d.ts',
            'admin/*.d.ts',
            '**/*.test.ts',
        ],
    },
    {
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-returns': 'off',
            '@typescript-eslint/consistent-type-imports': 'off',
            '@typescript-eslint/no-redundant-type-constituents': 'off',
        },
    },
];

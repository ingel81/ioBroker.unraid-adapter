import { expect } from 'chai';

describe('module to test => function to test', () => {
    const expected = 5;

    it(`should return ${expected}`, () => {
        const result = 5;
        expect(result).to.equal(expected);
    });
});

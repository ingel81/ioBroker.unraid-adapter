"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const apollo_client_1 = require("./apollo-client");
async function testArrayQuery() {
    const client = new apollo_client_1.UnraidApolloClient({
        baseUrl: process.env.UNRAID_URL || 'https://192.168.0.30',
        apiToken: process.env.UNRAID_TOKEN || '',
        allowSelfSigned: true
    });
    try {
        // Test 1: Simple query to check if array exists
        console.log('Testing array query...');
        const arrayQuery = await client.query(`
            query TestArray {
                array {
                    state
                }
            }
        `);
        console.log('Array query result:', JSON.stringify(arrayQuery, null, 2));
        // Test 2: Try subscription with minimal fields
        console.log('\nTesting minimal array subscription...');
        const subscription = client.subscribe(`
            subscription MinimalArraySub {
                arraySubscription {
                    state
                }
            }
        `);
        subscription.subscribe({
            next: (result) => {
                console.log('Minimal subscription result:', JSON.stringify(result, null, 2));
            },
            error: (error) => {
                console.error('Minimal subscription error:', error);
            }
        });
        // Keep alive for 5 seconds to receive updates
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    catch (error) {
        console.error('Test failed:', error);
    }
    finally {
        await client.dispose();
    }
}
// Run if called directly
if (require.main === module) {
    testArrayQuery().catch(console.error);
}
//# sourceMappingURL=test-introspection.js.map
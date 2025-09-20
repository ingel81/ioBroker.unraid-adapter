import { Adapter, AdapterOptions } from '@iobroker/adapter-core';

class UnraidAdapter extends Adapter {
    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'unraid-adapter',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
        // this.on("objectChange", this.onObjectChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
    }

    private async onReady(): Promise<void> {
        this.log.info(`config baseUrl: ${this.config.baseUrl || '<not set>'}`);
        this.log.info(
            `config apiToken: ${this.config.apiToken ? `set (${this.config.apiToken.length} characters)` : '<not set>'}`
        );

        await this.setObjectNotExistsAsync('testVariable', {
            type: 'state',
            common: {
                name: 'testVariable',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: true,
            },
            native: {},
        });

        this.subscribeStates('testVariable');

        await this.setStateAsync('testVariable', true);
        await this.setStateAsync('testVariable', { val: true, ack: true });
        await this.setStateAsync('testVariable', { val: true, ack: true, expire: 30 });

        const isPasswordValid = await this.checkPasswordAsync('admin', 'iobroker');
        this.log.info(`check user admin pw iobroker: ${isPasswordValid}`);

        const isInGroup = await this.checkGroupAsync('admin', 'admin');
        this.log.info(`check group user admin group admin: ${isInGroup}`);
    }

    private onUnload(callback: () => void): void {
        try {
            callback();
        } catch {
            callback();
        }
    }

    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (state) {
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            this.log.info(`state ${id} deleted`);
        }
    }

    // private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
    //     if (obj) {
    //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    //     } else {
    //         this.log.info(`object ${id} deleted`);
    //     }
    // }

    // private onMessage(obj: ioBroker.Message): void {
    //     if (typeof obj === 'object' && obj.message) {
    //         if (obj.command === 'send') {
    //             this.log.info('send command');
    //             if (obj.callback) {
    //                 this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
    //             }
    //         }
    //     }
    // }
}

if (module.parent) {
    module.exports = (options: Partial<AdapterOptions> | undefined) => new UnraidAdapter(options);
} else {
    (() => new UnraidAdapter())();
}

import React from 'react';

import GenericApp from '@iobroker/adapter-react/GenericApp';
import type { GenericAppProps } from '@iobroker/adapter-react/types';

import Settings from './components/settings';
import en from './i18n/en.json';
import de from './i18n/de.json';
import ru from './i18n/ru.json';
import pt from './i18n/pt.json';
import nl from './i18n/nl.json';
import fr from './i18n/fr.json';
import it from './i18n/it.json';
import es from './i18n/es.json';
import pl from './i18n/pl.json';
import zhCn from './i18n/zh-cn.json';

type AppProps = GenericAppProps;

type BaseTranslations = Record<string, Record<string, string>>;

class App extends GenericApp {
    public constructor(props: AppProps) {
        const baseTranslations: BaseTranslations = {
            en,
            de,
            ru,
            pt,
            nl,
            fr,
            it,
            es,
            pl,
            'zh-cn': zhCn,
        };

        const extendedProps: GenericAppProps = {
            ...props,
            encryptedFields: [],
            translations: baseTranslations,
        };

        super(props, extendedProps);

    }

    public onConnectionReady(): void {
        // executed when connection is ready
    }

    public render(): JSX.Element {
        if (!this.state.loaded) {
            return super.render();
        }

        const nativeConfig = this.state.native as ioBroker.AdapterConfig;

        return (
            <div className="App">
                <Settings
                    native={nativeConfig}
                    onChange={(attr, value) => this.updateNativeValue(attr as string, value)}
                />
                {this.renderError()}
                {this.renderToast()}
                {this.renderSaveCloseButtons()}
            </div>
        );
    }
}

export default App;

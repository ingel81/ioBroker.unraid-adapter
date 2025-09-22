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

/**
 * Application properties type alias
 */
type AppProps = GenericAppProps;

/**
 * Translation structure for internationalization
 */
type BaseTranslations = Record<string, Record<string, string>>;

/**
 * Main application component for the Unraid adapter configuration.
 * Extends GenericApp from ioBroker React framework.
 */
class App extends GenericApp {
    /**
     * Creates the application instance with translations.
     *
     * @param props - Application properties from ioBroker
     */
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

    /**
     * Callback when ioBroker connection is established.
     * Override this to perform initialization tasks.
     */
    public onConnectionReady(): void {
        // executed when connection is ready
    }

    /**
     * Render the application UI.
     *
     * @returns The main application JSX element
     */
    public render(): JSX.Element {
        if (!this.state.loaded) {
            return super.render();
        }

        const nativeConfig = this.state.native as ioBroker.AdapterConfig;

        return (
            <div className="App">
                <div
                    style={{
                        maxHeight: 'calc(100vh - 75px)',
                        overflowY: 'auto',
                    }}
                >
                    <Settings
                        native={nativeConfig}
                        onChange={(attr, value) => this.updateNativeValue(attr as string, value)}
                        themeType={this.state.themeType}
                    />
                </div>
                {this.renderError()}
                {this.renderToast()}
                {this.renderSaveCloseButtons()}
            </div>
        );
    }
}

export default App;

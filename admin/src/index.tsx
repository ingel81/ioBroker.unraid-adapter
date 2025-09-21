import React from 'react';
import ReactDOM from 'react-dom';
import { MuiThemeProvider } from '@material-ui/core/styles';
import theme from '@iobroker/adapter-react/Theme';
import Utils from '@iobroker/adapter-react/Components/Utils';
import App from './app';

let themeName = Utils.getThemeName();

const renderApp = (): void => {
    const rootElement = document.getElementById('root');
    if (!rootElement) {
        throw new Error('root element not found');
    }

    ReactDOM.render(
        <MuiThemeProvider theme={theme(themeName)}>
            <App
                adapterName="unraid-adapter"
                onThemeChange={(nextTheme: string) => {
                    themeName = nextTheme;
                    renderApp();
                }}
            />
        </MuiThemeProvider>,
        rootElement,
    );
};

renderApp();

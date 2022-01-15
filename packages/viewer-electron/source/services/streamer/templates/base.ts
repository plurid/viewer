// #region imports
    // #region libraries
    import {
        strings,
    } from '@plurid/plurid-functions';
    // #endregion libraries
// #endregion imports



// #region module
const head = (
    name: string,
) => strings.removeWhitespace(`
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <meta name=”robots” content=”noindex,nofollow” />
    <meta name="description" content="${name}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="plurid" />
    <meta property="og:title" content="${name}" />

    <title>${name}</title>

    <style>
        @import url('https://fonts.googleapis.com/css?family=Ubuntu&display=swap');

        html, body {
            margin: 0;
            background: #242b33;
            color: #ddd;
            user-select: none;
        }

        .viewer {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-family: 'Ubuntu', -apple-system, system-ui, BlinkMacSystemFont, 'Segoe UI', Roboto;
        }
    </style>
</head>
`);


const html = (
    name: string,
    body: string,
) => strings.removeWhitespace(`
<!DOCTYPE html>
<html lang="en">
    ${head(name)}
    ${body}
</html>
`);
// #endregion module



// #region exports
export {
    head,
    html,
};
// #endregion exports

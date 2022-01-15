// #region imports
    // #region libraries
    import path from 'path';
    import fs from 'fs';
    // #endregion libraries
// #endregion imports



// #region module
export const sendFile = (
    request: any,
    response: any,
    filePath: string,
    contentType: string,
) => {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = request.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const file = fs.createReadStream(filePath, {
            start,
            end,
        });
        const headers = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': contentType,
        };

        response.writeHead(206, headers);
        file.pipe(response);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': contentType,
        };

        response.writeHead(200, head);
        fs.createReadStream(filePath).pipe(response);
    }
}


export const streamVideo = (
    request: any,
    response: any,
    file: string,
    contentType: string = 'video/mp4',
) => {
    sendFile(
        request,
        response,
        file,
        contentType,
    );
}
// #endregion module

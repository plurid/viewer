// #region module
const getNumber = (
    value: string,
) => {
    if (typeof value !== 'string') {
        return;
    }

    if (isNaN(parseFloat(value))) {
        return;
    }

    return parseFloat(value);
}


const secondsToMMSS = (
    value: number,
) => {
    const date = new Date(0);
    date.setSeconds(value);

    const timeString = date.toISOString().substr(14, 5);

    return timeString;
}


const range = (
    start: number,
    end: number,
) => {
    return Array.from(
        {
            length: end - start + 1,
        },
        (_, k) => k + start,
    );
}
// #endregion module



// #region exports
export {
    getNumber,
    secondsToMMSS,
    range,
};
// #endregion exports

import {
    BrowserWindow,
    TouchBar,
} from 'electron';



const {
    TouchBarButton,
    TouchBarSlider,
    TouchBarSpacer,
    TouchBarSegmentedControl,
} = TouchBar;



let transformModeValue = 'left/right';

const generateTouchBar = (
    window: BrowserWindow,
    regenerate: () => void,
) => {
    const transformSelector = new TouchBarSegmentedControl({
        change: (index, isSelected) => {
            console.log('change', index, isSelected);
        },
        mode: 'multiple',
        segments: [
            {
                label: 'translate',
            },
            {
                label: 'rotate',
            },
            {
                label: 'scale',
            },
        ],
    });


    const spacer = new TouchBarSpacer({
        size: 'large',
    });


    const transformMode = new TouchBarButton({
        label: transformModeValue,
        click: () => {
            console.log('mode clicked');
            console.log('mode clicked', transformModeValue);
            transformModeValue = transformModeValue === 'up/down'
                ? 'left/right'
                : 'up/down';
            console.log('mode clicked', transformModeValue);
            regenerate();
        },
    });

    let sliderValue = 50;

    const slider = new TouchBarSlider({
        minValue: 0,
        maxValue: 100,
        value: sliderValue,
        change: (newValue) => {
            window.webContents.send('TOUCHBAR_SLIDER', newValue);
        },
    });

    const touchBar = new TouchBar({
        items: [
            transformSelector,
            spacer,
            transformMode,
            slider,
        ],
    });

    return touchBar;
}



export default generateTouchBar;

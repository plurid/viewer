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


// 0: 'translate'
// 1: 'rotate'
// 2: 'scale'
let transformType = 0;

let transformModeValue = 'left/right';

let sliderValue = 50;

const generateTouchBar = (
    window: BrowserWindow,
    regenerate: () => void,
) => {
    const transformSelector = new TouchBarSegmentedControl({
        change: (index, isSelected) => {
            if (isSelected) {
                transformType = index;
            } else {
                transformType = -1;
            }
            console.log('change', index, isSelected);
        },
        selectedIndex: transformType,
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
        size: 'small',
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

    const slider = new TouchBarSlider({
        minValue: 0,
        maxValue: 100,
        value: sliderValue,
        change: (newValue) => {
            window.webContents.send('TOUCHBAR_SLIDER', newValue);
            sliderValue = newValue;
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

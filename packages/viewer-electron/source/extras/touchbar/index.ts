import { 
    BrowserWindow,
    TouchBar,
} from 'electron';



const { 
    TouchBarButton, 
    TouchBarSlider, 
    TouchBarSegmentedControl, 
} = TouchBar;


const generateTouchBar = (
    window: BrowserWindow,
) => {
    const segmentedControlTypes = new TouchBarSegmentedControl({
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
    
    
    const transformType = new TouchBarButton({
         label: 'up/down',
    });
    
    let sliderValue = 50;
    
    const slider = new TouchBarSlider({
        minValue: 0,
        maxValue: 100,
        value: sliderValue,
        change: (newValue) => {
            console.log('newValue', newValue);
            window.webContents.send('TOUCHBAR_SLIDER', newValue);
        },
    });
    
    const touchBar = new TouchBar({
        items: [
            segmentedControlTypes,
            slider,
        ],
    });

    return touchBar;
}



export default generateTouchBar;

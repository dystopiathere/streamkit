import { RouletteReel } from './RouletteReel';
import { RouletteWheel, type RouletteWheelProps } from './RouletteWheel';

/**
 * Рулетка в кадре: колесо или вертикальная лента, смотря что выбрано.
 *
 * Выбор делает один компонент, а не каждое приложение: оверлей, предпросмотр и
 * кадр раскладки обязаны показывать одно и то же. Конфиг сюда приходит уже
 * приведённым к тарифу, поэтому без «Про» здесь всегда колесо.
 */
export function RouletteDisplay(props: RouletteWheelProps): React.JSX.Element {
  return props.config.mode === 'vertical' ? (
    <RouletteReel {...props} />
  ) : (
    <RouletteWheel {...props} />
  );
}

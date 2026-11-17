import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import { base } from '../../eslint.config.mjs';

const config = [...base, ...nextCoreWebVitals];

export default config;

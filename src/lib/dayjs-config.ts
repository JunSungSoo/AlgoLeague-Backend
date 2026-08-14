import dayjs from "dayjs";
import "dayjs/locale/ko";
import isoWeek from "dayjs/plugin/isoWeek";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

export const SEOUL_TIME_ZONE = "Asia/Seoul";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.locale("ko");
dayjs.tz.setDefault(SEOUL_TIME_ZONE);

export { dayjs };

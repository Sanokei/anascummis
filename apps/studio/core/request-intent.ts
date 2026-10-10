/** Fresh information is an explicit network request, even without saying “search”. */
export function requestsOnlineTools(text:string){return /https:\/\//i.test(text)||/\b(online|internet|youtube|web|news|research|search online|public page|screenshots? of|current|currently|latest|today|right now|up.to.date|recent|situation in)\b/i.test(text);}
export function newsQuestion(text:string){return requestsOnlineTools(text)&&/\b(news|current|currently|latest|today|right now|recent|situation)\b/i.test(text)&&!/\b(create|make|edit|build|send|download|screenshot|video|website|pdf)\b/i.test(text);}

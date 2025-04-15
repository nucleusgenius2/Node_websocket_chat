import axios from 'axios';
import http from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

import {VerifyTokenResult, TokenPayload} from './types/auth';
import {GlobalObjectUser, UserList} from './types/user';
import {CustomWebSocket, DataSend, DataSendPersonal, UserPublicData, StartData } from './types/websoclet';

import {
    chatSchema,
    chatPublicMessageSchema,
    tokenSchema
} from './validation/chat';

const secret = process.env.WEBSOCKET_JWT_SECRET;
const httpPort =  process.env.HTTP_PORT;
const wsPort = process.env.WS_PORT;
const serverLaravel = process.env.DOMAIN_SEVER;


console.log('старт', secret)

let objectUser: GlobalObjectUser = {
    countUserChat : 0,
    usersData: {},
    usersList: {},
};
let newUser: Record<string, TokenPayload> = {};


/*
const server = https.createServer({
    cert: fs.readFileSync('/etc/letsencrypt/live/api.winmove.io/fullchain.pem'),
    key: fs.readFileSync('/etc/letsencrypt/live/api.winmove.io/privkey.pem'),
    port: wsPort,
    maxPayload: 1024 * 1024
});
const wss = new ws.Server({ server});
 */

const wss = new WebSocketServer({port: wsPort, maxPayload: 1024 * 1024}); //лимит на передачу данных (162 килобайта проходят, а 512 уже нет)
wss.on('connection',onConnect);


function base64UrlDecode(str: string): string {
    // Восстанавливаем Base64 из URL-safe формата
    return Buffer.from(
        str.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
    ).toString('utf-8');
}

/**
 * Проверка JWT токена
 */
function verifyToken(token: string): VerifyTokenResult {
console.log(token);
    const parts: string[] = token.split('.');

    if (parts.length !== 3) {
        return { valid: false, error: 'Не валидный формат токена' };
    }

    const [headerEncoded, payloadEncoded, signatureProvided] = parts;

    // Пересчитываем подпись с использованием того же алгоритма (HS256) и секретного ключа
    const signatureExpected: string = crypto
        .createHmac('sha256', secret)
        .update(`${headerEncoded}.${payloadEncoded}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    //console.log("Ожидаемая подпись:", signatureExpected);

    // Проверка подписи
    if (signatureProvided !== signatureExpected) {
        return { valid: false, error: 'Не валидная подпись' };
    }

    try {
        const payload: TokenPayload = JSON.parse(base64UrlDecode(payloadEncoded));

        // Проверяем срок действия токена
        const currentTime = Math.floor(Date.now() / 1000);
        if (payload.exp < currentTime) {
            return { valid: false, error: 'Срок действия токена истек' };
        }

        return { valid: true, payload };
    } catch (err) {
        return { valid: false, error: 'Ошибка декодирования полезной нагрузки' };
    }
}


function onConnect(ws: CustomWebSocket, req: http.IncomingMessage): void { //ws - соединение, req параметры из url запроса
    let url = new URLSearchParams(req.url);
    let userToken = url.get('token');

    let { error, value: token} = tokenSchema.validate(userToken);

    if (error) {
        console.log("Ошибка валидации:", error.details[0].message);
        ws.close();
    }

    let checkToken = verifyToken(token )
    if (checkToken.valid){
        let user: TokenPayload = checkToken.payload

        //проверяем есть ли у юзера уже открытый веб сокет (проверка идет по токену и по имени)
        if (objectUser.usersData[user.u_uuid]){
            console.log('дубль');
            ws.close();
        }

        let idNewUser = user.u_uuid;
        //console.log('новый юзер' + idNewUser)
        newUser[idNewUser] = user;

        //записали в объект соединения токен и имя юзера как идентификатор (будет доступен при переборе соединений)
        ws.user_uuid = user.u_uuid;

        //сохраняем данные юзера из базы в объект c данными всех юзеров, ключ = id из токена
        objectUser.usersData[idNewUser] = newUser[idNewUser];

        //формируем объект публичных данных юзера, которые можно передавать всем юзерам по веб сокету
        objectUser.usersList[idNewUser] = {
            //id: newUser[idNewUser].id,
            name: newUser[idNewUser].name,
            u_uuid: newUser[idNewUser].u_uuid,
            level: newUser[idNewUser].level,
            avatar: newUser[idNewUser].avatar,
        }

    }
    else{
        console.log('ошибка авторизации '+userToken);
        ws.close()
    }

    //срабатывает когда веб сокет получает входящее сообщение
    ws.on('message', function (message: string | Buffer): void {
          try {
              let data = JSON.parse(message.toString());
              console.log(data)

              //антиспам — не более 5 сообщений в секунду
              const now = Date.now();
              ws.message_timestamps = ws.message_timestamps || [];

              //убираем старые таймштампы (старше 1000 мс)
              ws.message_timestamps = ws.message_timestamps.filter(ts => now - ts < 1000);

              // добавляем текущий
              ws.message_timestamps.push(now);

              // Проверка лимита
              if (ws.message_timestamps.length > 5) {
                  console.log(`Флуд от ${ws.user_uuid}, соединение закрыто`);
                  ws.close();
                  return;
              }


              //пинги не валидируем
              if(data?.type==='ping'){return}

              // валидация
              let { error, value: validData } = chatPublicMessageSchema.validate(data);
              if (error) {
                  console.log("Ошибка валидации:", error.details[0].message);
                  ws.close();
              }
              else {
                  console.log('validData', validData);
                  if (ws.user_uuid && objectUser.usersList[ws.user_uuid]) {
                      //находим юзера приславшего сообщение в объекте всех юзеров по uuid
                      let user = objectUser.usersList[ws.user_uuid];
                      console.log('сообщение в чат');

                      let dataSend: DataSend = {
                          u_uuid : user.u_uuid,
                          data : validData.data,
                          type : 'publicMessage',
                      }

                      if (validData.type === 'publicMessage') {
                          dataAllSend(dataSend, true)
                      }
                  }
                  else{
                      console.log("не зарегистрированный коннект");
                  }
              }
          } catch (err) {
              console.error('Ошибка при парсинге данных:', err);
              ws.close();
          }
      });



    //срабатывает при отключении юзера от чата (его сокет обрывается)
    ws.on('close', function(): void {
        if (ws.user_uuid && typeof (objectUser.usersData[ws.user_uuid]) !== 'undefined') {
            if (objectUser.usersList[ws.user_uuid]?.u_uuid) {
                let dataSend: DataSend  = {
                    type : 'logoutUser',
                    u_uuid : objectUser.usersList[ws.user_uuid].u_uuid,
                }
                //обновляем данные у всех - отправляем данные игрока который вышел из чата
                dataAllSend(dataSend)
            }

            //удаляем юзера из объекта юзеров
            //console.log('вышел ' + ws.user_uuid)
            delete objectUser.usersData[ws.user_uuid];

            if (typeof (objectUser.usersList[ws.user_uuid]) !== 'undefined') {
                delete objectUser.usersList[ws.user_uuid];
            }
        }

    });

    ws.on('error', function(): void {
        console.log('ошибка веб сокета')
    })

}

//интервал отправки данных о новых юзерах (интервал создан для оптимизации нагрузки - меньше переборов на беке и перерендера фронте)
setInterval((): void => {

    //проверка есть ли новые юзеры
    if (Object.keys(newUser).length > 0) {
        wss.clients.forEach(function (client: CustomWebSocket): void {

            if (client.readyState === 1 && client.user_uuid) {
                //console.log('первичное сообщение'+client.user_uuid)
                //уведомление только новых юзеров - отдаем им стартовый объект со списком всех юзеров в чате.
                if (client.user_uuid in newUser) {
                    let objectStarData: StartData  = {
                        type : 'startDada',
                        users: objectUser.usersList,
                    }
                    client.send(JSON.stringify(objectStarData));
                }
                //всем юзерам (кроме новых) говорим о том, что присоединился новый юзер
                if (!newUser[client.user_uuid]){

                    for (let key in newUser) {
                        //проверяем что юзер еще не закрыл соединение
                        if ( typeof (objectUser.usersList[key]) !== 'undefined' ) {
                            let dataSend: StartData = {
                                type: 'addUser',
                                data: objectUser.usersList[key],
                            }
                            client.send(JSON.stringify(dataSend));
                        }
                    }

                }
            }
        });

        //удаление из объекта новых юзеров
        wss.clients.forEach(function (client: CustomWebSocket) {
            if (client.user_uuid && client.user_uuid in newUser) {
                //console.log('удаление нового юзера из объекта ' + client.user_uuid)
                delete newUser[client.user_uuid];
            }
        });

    }
}, 2000);


// Отправка всем подключенным к сокету юзерам
function dataAllSend(data: DataSend, userSendPublic: boolean = false): void{

    let userPublicData = getPublicDataUser(data.u_uuid);
    if(userPublicData){
        data.user = userPublicData;
    }

    wss.clients.forEach((client: CustomWebSocket): void => {
        if (client.readyState === 1) {
            console.log('отправка '+client.user_uuid);
            client.send(JSON.stringify(data));
        }
    });
}

// Отправка конкретному юзеру
function dataPersonalSend(dataRequest: DataSendPersonal): void{

    let publicData  = getPublicDataUser(dataRequest.u_uuid);

    wss.clients.forEach((client: CustomWebSocket): void => {

        if ((client.readyState === 1) && (client.user_uuid === dataRequest.u_uuid)) {
            //console.log('отправка персонально '+client.user_uuid);

            client.send(JSON.stringify(publicData));
        }
    });
}

//возвращает публичные данные юзера, которые можно отправлять в сокет
function getPublicDataUser(userId: string): UserPublicData | null {
    let publicData: UserList = objectUser.usersList[userId];
    if (publicData) {

        return  {
            'avatar': publicData['avatar'],
            "name": publicData['name'],
            "level": publicData['level'],
        }
    }
    else{
        return null
    }
}

//опциональное получение данных из внешних источников, в данном примере http, но по хорошему должен быть rebbit
function httpRequest(req: IncomingMessage, res: ServerResponse): void {

    if (req.method === 'POST') {
        console.log('пост');
        let jsonString = '';

        req.on('data', function (data: Buffer): void {
            jsonString += data;
        });

        req.on('end', function (): void {
            try {
                let dataRequest = JSON.parse(jsonString);
                console.log(dataRequest );
                // Валидация
                let { error, value } = chatSchema.validate(dataRequest);
                if (error) {
                    console.log("Ошибка валидации:", error.details[0].message);

                    res.writeHead(422, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        status: 'error',
                    }));
                    return;
                }

                if( dataRequest.type==='logMessage' ){
                    console.log('глобальный объект юзеров')
                    console.log(objectUser.usersList)
                    dataAllSend(dataRequest)
                }

                if( dataRequest.type==='publicMessage' || dataRequest.type==='winnersGameMessage' ){
                    dataAllSend(dataRequest, true)
                }

                if( dataRequest.type==='notificationsMessage' || dataRequest.type==='alertMessage' ){
                    dataPersonalSend(dataRequest)
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'success',
                }));

            } catch (err) {
                console.error('Ошибка при парсинге данных:', err);
                res.writeHead(422, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'error',
                    message: 'Invalid JSON format'
                }));
            }
        });

    }
}

//слушаем http по 9000 порту
http.createServer(httpRequest).listen(httpPort);


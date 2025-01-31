const axios = require('axios');
const http = require('http');
const ws = require('ws');
const Joi = require('joi');
const crypto = require('crypto');

//const port = 3000;
const serverLaravel = 'http://localhost:80';

const secret = ''
console.log('старт')

let objectUser = {
  'countUserChat' : 0,
  'usersData' : {},
  'usersList' : {},
  //'usersNameAndToken' : {},
  //'usersTokenAndName' : {},
};
let newUser = {};
let sendData = {};
let sendDataUniqueID = {};

//const wss = new ws.Server({noServer: true});
const wss = new ws.Server({port: 9999, maxPayload: 1024 * 1024}); //лимит на передачу ( 162 килобайта проходят а 512 уже нет, гдето между ними)
wss.on('connection',onConnect);



function base64UrlDecode(str) {
    // Восстанавливаем Base64 из URL-safe формата
    return Buffer.from(
        str.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
    ).toString('utf-8');
}

/**
 * Проверка JWT токена
 */
function verifyToken(token) {
    const parts = token.split('.');

    if (parts.length !== 3) {
        return { valid: false, error: 'Не валидный формат токена' };
    }

    const [headerEncoded, payloadEncoded, signatureProvided] = parts;

    // Пересчитываем подпись с использованием того же алгоритма (HS256) и секретного ключа
    const signatureExpected = crypto
        .createHmac('sha256', secret)
        .update(`${headerEncoded}.${payloadEncoded}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    console.log("Ожидаемая подпись:", signatureExpected);

    // Проверка подписи
    if (signatureProvided !== signatureExpected) {
        return { valid: false, error: 'Не валидная подпись' };
    }

    // Декодируем полезную нагрузку (payload)
    const payload = JSON.parse(base64UrlDecode(payloadEncoded));

    // Проверяем срок действия токена
    const currentTime = Math.floor(Date.now() / 1000);
    if (payload.exp < currentTime) {
        return { valid: false, error: 'Token has expired' };
    }

    return { valid: true, payload };
}

function onConnect(ws,req) { //ws - соединение, req параметры из url запроса
    let errorUser = '';
    //вся валидация теперь тут
    let url = new URLSearchParams(req.url);
    let userToken = url.get('token');


    //получить количество активных веб сокетов
    let number = 0;

    let checkToken = verifyToken(userToken)
    if(checkToken.valid){
        let user = checkToken.payload
        //проверяем есть ли у юзера уже открытый веб сокет (проверка идет по токену и по имени)
        wss.clients.forEach(function (client)
        {
            if (client.readyState === ws.OPEN) {
                //закрытие только прошлого веб сокета, а не текущего
                console.log('11 ' + client.user_uuid)
                console.log('11 ' + user.id)
                if (client.user_uuid && user.id === client.user_uuid) {
                    console.log(client.user_uuid)
                        // console.log('1 ' +client.user_name );
                        //console.log('2 ' + success.data.json.name  );
                        // console.log('3 ' + userToken  );
                    console.log('дубликат соединения');
                    ws.close();
                    client.close();
                }
            }
        });

        let idNewUser = user.id;
        console.log('новейший юзер' + idNewUser)
        newUser[idNewUser] = user;
        //newUser[nameNewUser].token = userToken;


        //записали в объект соединения токен и имя юзера как идентификатор (будет доступен при переборе соединений)
        ws.user_uuid = user.id;
           // ws.user_name = nameNewUser;


            //проверка активных юзеров
            // wss.clients.forEach(function (client) {
            //   console.log('p '+client.user)
            //   console.log('p '+client.user_name)
            //});

        //сохраняем данные юзера из базы в объект c данными всех юзеров, ключ = id из токена
        objectUser.usersData[idNewUser] = newUser[idNewUser];
        //формируем объект публичных данных юзера, которые можно передавать всем юзерам по веб сокету (токены юзеров ни в коем слухаче не должны передаваться)
        objectUser.usersList[idNewUser] = {
            id: newUser[idNewUser].id,
            name: newUser[idNewUser].name,
        }
        //объект в котором можно по имени получить токен, нужен для приватного чата
        //objectUser.usersNameAndToken[newUser[nameNewUser].name] = newUser[nameNewUser].token;
        //объект в котором можно по токену получить имя, нужен при выходе игрока из чата
        //objectUser.usersTokenAndName[newUser[nameNewUser].token] = newUser[nameNewUser].name;


    }
    else{
        console.log('ошибка авторизации '+userToken);
        ws.close()
    }
    console.log('успех');


    //интервал отправки данных о новых юзерах (интервал создан для оптимизации нагрузки - меньше переборов на беке и перерендера фронте)
    setTimeout(() => {
        number = 0;

        wss.clients.forEach(function (client) {
            if (client.readyState === ws.OPEN) {
                number++;
            }
        });
        objectUser.countUserChat = number;


        //проверка есть ли новые юзеры
        if (Object.keys(newUser).length > 0) {
            //уведомление только новых юзеров - отдаем им стартовый объект со списком всех юзеров в чате.
            wss.clients.forEach(function (client) {

                if (client.readyState === ws.OPEN) {
                    console.log('первичное сообщение'+client.user_uuid)
                    if (client.user_uuid in newUser) {
                        let objectStarData = {
                            type : 'startDada',
                            users: objectUser.usersList,
                        }
                        client.send(JSON.stringify(objectStarData));
                    }
                }
            });

            //всем юзерам (кроме нового) говорим о том, что присоединился новый юзер
            wss.clients.forEach(function (client) {
                if (client.readyState === ws.OPEN) {

                    if (!newUser[client.user_uuid]){
                        //перебор объекта новых юзеров
                        for (let key in newUser) {
                            //проверяем что юзер еще закрыл соединение
                            if ( typeof (objectUser.usersList[key]) !== 'undefined' ) {
                                let dataSend = {
                                    type: 'addUser',
                                    data: objectUser.usersList[key],
                                }
                                           // console.log(key)
                                           // console.log('add')
                                            //console.log(dataSend)
                                client.send(JSON.stringify(dataSend));
                            }
                            else{
                                console.log('не найден в общем объекте юзеров'+key)
                            }
                        }

                    }
                }
            });

                        //отправить только новым юзерам актуальную информацию по созданным играм
            /*
                        wss.clients.forEach(function (client) {

                            if (client.user_name in newUser) {
                                let dataSend = {
                                    "name": 'gam',
                                    "data": lastDataGameLobbi,
                                }
                                console.log('все кроме нового юзера ' + client.user_name)
                                client.send(JSON.stringify(dataSend));
                            }
                        });

             */

            //удаление из объекта новых юзеров
            wss.clients.forEach(function (client) {
                if (client.user_uuid in newUser) {
                    console.log('удаление нового юзера из обьекта ' + client.user_uuid)
                    delete newUser[client.user_uuid];
                }
            });

        }
    }, "2000");



                    
    //срабатывает когда веб сокет получает входящее сообщение
    ws.on('message', function (message) {
        let data = JSON.parse(message);
        console.log(data)
        //валидация входящей даты
        let validate = 1;
        let ban = 0;
        let error = 0;
        /*
        try {
            //валидация токена первична

         */

                            if( error === 0){
                                //защита от спама данных на веб сокет (данные не чаще чем раз в 2 секунды)
                                if ( data.chatAdresat !== 'game_stream' && data.chatAdresat !== 'game_end' ) {//игровые данные не валидируем
                                //console.log('проверка')
                                    if ( typeof (ws.limit_time) == 'undefined' || typeof (ws.limit_time) == null){
                                        ws.limit_time = Date.now();
                                    }
                                    else{
                                        let timeout = Date.now() - ws.limit_time;
                                        if ( timeout < 2000 ){
                                            //лимит превышен, 2 проверка
                                            if ( typeof (ws.limit_time_2) == 'undefined' || typeof (ws.limit_time_2) == null){
                                                ws.limit_time_2 = Date.now();
                                            }
                                            else{
                                                let timeout_2 = Date.now() - ws.limit_time_2;
                                                if ( timeout_2 < 2000 ){
                                                    validate = 0 ;
                                                    ban = 1;
                                                     console.log(data)
                                                }
                                                else{
                                                    ws.limit_time_2 = Date.now();
                                                }
                                            }
                                        }
                                        else{
                                            ws.limit_time = Date.now();
                                        }
                                    }
                                }
                            }


                          //рвем связь с юзером приславшим не валидные данные и сделать бан
                          if ( ban === 1 ){
                              console.log('не валидные данные - терминате конект')
                              console.log(data)
                             //выдать бан

                             //закрываем конект у текущего юзера
                             //ws.close();
                              //warning('not_valid_data','', data, errorUser, ws._socket.remoteAddress);
                              ws.terminate();
                          }


                          if ( validate === 1){

                              //находим юзера приславшего сообщение в объекте всех юзеров по uuid
                              let user = objectUser.usersList[ws.user_uuid];
                             console.log('сообщение в чат');

                             let dataSend = {
                                 "name": user.name,
                                 "data": user,
                                 "type": 'publicMessage',
                                 "message": data.message,
                             }

                             if ( data.type === 'publicMessage') {

                                 //ответ с сервера всем подключенным юзерам
                                 wss.clients.forEach(function (client) {
                                     if (client.readyState === ws.OPEN) {
                                         client.send(JSON.stringify(dataSend));
                                     }
                                 });

                             }

                          }

                });



                //срабатывает при отключении юзера от чата (его сокет обрывается)
                ws.on('close', function() {
                    //проблема - если дубль конекта, то эта функция срабатывает после добавления нового конекта, итого у юзера тут будет 2 конекта, поэтому нельзя удалять его из объекта если у него 2 конекта, так как закрывается только 1 из 2
                    //проверка активных юзеров
                    let removeUserData = true;
                    wss.clients.forEach(function (client) {
                       console.log('тест условия'+client.readyState+'-'+ws.user_uuid)
                        //client.readyState значит открыт
                        if ( client.readyState === 1) {
                            if (client.user_uuid === ws.user_uuid){
                                removeUserData = false
                                console.log('запрет удалять из объекта юзера '+ws.user_uuid)
                            }
                            console.log('11111111111 ' + client.user_uuid)
                        }
                    });
                    if (removeUserData) {
                        if (typeof (objectUser.usersData[ws.user_uuid]) !== 'undefined') {
                            if (objectUser.usersList[ws.user_uuid]?.id) {
                                let dataSend = {
                                    "type": 'logoutUser',
                                    "data": objectUser.usersList[ws.user_uuid],
                                }

                                //обновляем данные у всех - отправляем имя игрока который вышел из чата
                                wss.clients.forEach(function (client) {
                                    if (client.readyState === ws.OPEN) {
                                        console.log(client.user_uuid)
                                        client.send(JSON.stringify(dataSend));
                                    }
                                });
                            }

                            //удаляем юзера из объекта юзеров

                            console.log('вышел ' + ws.user_uuid)
                            delete objectUser.usersData[ws.user_uuid];

                            if (typeof (objectUser.usersList[ws.user_uuid]) !== 'undefined') {
                                delete objectUser.usersList[ws.user_uuid];
                            }
                        }


                        console.log(objectUser.usersList)

                        //проверка активных юзеров
                        wss.clients.forEach(function (client) {
                            console.log(client.readyState)
                            console.log('проверка ' + client.user_uuid)
                        });


                    }
                    else{
                        console.log('вышел, но есть еще коннект с ним ' + ws.user_uuid)
                    }


                                //проверка активных юзеров
                                //wss.clients.forEach(function (client) {
                                //    console.log('r '+client.user)
                                //    console.log('r '+client.user_name)
                                //});


                });

                ws.on('error', function() {
                    console.log('ошибка веб сокета')
                })

                        //return 'avtorization';
                       // wss.handleUpgrade(req, req.socket, Buffer.alloc(0), onConnect);

                        //записали в обьект соединения ник юзера как идентификатор (будет доступен при переборе соединений)
                        //ws.user = newUser.token;


}

if (!module.parent) {
  //http.createServer(accept).listen(8082);
} else {
  exports.accept = accept;
}


// Отправка всем подключенным к сокету юзерам
function dataAllSend(dataRequest){

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            console.log('отправка '+client.user_uuid);
            client.send(JSON.stringify(dataRequest));
        }
    });
}

// Отправка конкретному юзеру
function dataPersonalSend(dataRequest){

    wss.clients.forEach((client) => {
        if ((client.readyState === WebSocket.OPEN) && (client.user_uuid === dataRequest.user_id)) {
            console.log('отправка персонально '+client.user_uuid);
            client.send(JSON.stringify(dataRequest));
        }
    });
}


function httpRequest(req, res) {

    console.log('http пришел');
    if (req.method === 'POST') {
        console.log('пост');
        var jsonString = '';

        req.on('data', function (data) {
            jsonString += data;
        });

        req.on('end', function () {
            try {
                let dataRequest = JSON.parse(jsonString);
                console.log('111')
                console.log(dataRequest)
                // console.log(dataRequest)
                //валидация входящей даты

                if (typeof (dataRequest.user_name) !== null && typeof( dataRequest.type) ==='string' && typeof( dataRequest.user_id) !== null ) {
                    if( dataRequest.type==='publicMessage' ){
                        dataAllSend(dataRequest)
                    }
                    if( dataRequest.type==='notificationsMessage' ){
                        dataPersonalSend(dataRequest)
                    }


                        console.log('99999');

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        status: 'success',
                    }));
                }
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
http.createServer(httpRequest).listen(9000);


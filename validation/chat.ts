import Joi from 'joi';

export const chatSchema = Joi.object({
    type: Joi.string().min(3).required(),
    data: Joi.string().required(),
    u_uuid: Joi.number().integer().min(1).required(),
    user_id_original: Joi.number().integer().min(1).required(),
    user: Joi.object({
        name: Joi.string().required(),
        avatar: Joi.string().allow(null),
        level: Joi.number().integer().allow(null),
    }).required()
});

export const chatPublicMessageSchema = Joi.object({
    type: Joi.string().min(3).required(),
    data: Joi.string().required(),
    user_id: Joi.number().integer().min(1),
});

export const tokenSchema = Joi.string().min(10).required();

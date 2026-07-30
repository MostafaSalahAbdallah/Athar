import React from 'react'
import Button from './Button'

export default function Card(props) {
    return (
        <div>
            <div className="card bg-base-300 w-60 shadow-lg">
                <figure>
                    <img
                        src={props.img}
                        alt="Hadith book img" />
                </figure>
                <div className="card-body" dir="rtl">
                    <h2 className="card-title">{props.title}</h2>
                    <p>{props.description}</p>
                    <div className="card-actions justify-end">
                        <Button name="أبدأ الان"/>
                    </div>
                </div>
            </div>
        </div>
    )
}
